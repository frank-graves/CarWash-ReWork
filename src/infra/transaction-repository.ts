// src/infra/transaction-repository.ts
// El libro mayor de lavados (washLedger). Inmutable por diseño:
// una transacción registrada nunca se modifica, solo se añaden nuevas — o se
// anulan, que es un borrado, no una reescritura.

import {
	collection,
	deleteDoc,
	doc,
	getDocs,
	query,
	orderBy,
	limit,
	onSnapshot,
	serverTimestamp,
	runTransaction,
	Timestamp,
	type QuerySnapshot,
} from "firebase/firestore";
import type {
	CustomerSnapshot,
	CustomerView,
	PaymentMethod,
	ServiceTier,
	VehicleKind,
	WashTransactionDocument,
	WashTransactionView,
} from "@core/types";
import { nextAccumulatedValue } from "@core/loyalty";
import { PrivacyVault } from "@infra/crypto";
import { SessionKeyManager } from "@infra/session-key";
import type { FirebaseRuntime } from "@infra/firebase-bootstrap";

export interface RecordWashInput {
	customer: CustomerView;
	vehicleKind: VehicleKind;
	serviceTier: ServiceTier;
	cost: number;
	wasFree: boolean;
	paidWith: PaymentMethod;
	registeredBy: { id: string; name: string };
	washer: { id: string; name: string };
	/**
	 * Fecha del lavado. Si es undefined o es hoy, se usa serverTimestamp()
	 * (evita desajustes de reloj entre dispositivos). Si es una fecha pasada,
	 * se persiste como Timestamp.fromDate() a mediodía UTC para consistencia
	 * (misma hora del día sin importar la zona horaria del dispositivo).
	 */
	transactionDate?: Date;
}

// Tipo auxiliar para leer documentos legacy sin recurrir a `any`.
interface LegacyTransactionFields {
  operatorId?: string;
  operatorName?: string;
}

// Un documento schemaVersion 1 (el que escribió la fase anterior) no trae los
// campos nuevos aunque el tipo los exija. Se leen como opcionales para que el
// fallback sea alcanzable también para el compilador: TS marca como inalcanzable
// un `??` cuyo operando izquierdo es un campo obligatorio.
type StoredTransaction =
  Partial<Pick<WashTransactionDocument, "registeredByName" | "washerName">> &
  LegacyTransactionFields;

// Mismo día según el calendario UTC. Se compara lo que devuelve el input (fecha
// local del operador) contra el instante actual: a las 23:00 en un huso muy
// positivo la cuenta puede bailar un día, y lo asumimos — el caso normal es un
// negocio que carga el lavado de ayer, no uno que lo carga a medianoche.
function isSameUtcDay(a: Date, b: Date): boolean {
	return (
		a.getUTCFullYear() === b.getUTCFullYear() &&
		a.getUTCMonth() === b.getUTCMonth() &&
		a.getUTCDate() === b.getUTCDate()
	);
}

export class TransactionRepository {
	private readonly transactionsPath: string;
	private readonly customersPath: string;

	constructor(
		private readonly runtime: FirebaseRuntime,
		private readonly workspaceId: string,
	) {
		this.transactionsPath = `workspaces/${this.workspaceId}/transactions`;
		this.customersPath = `workspaces/${this.workspaceId}/customers`;
	}

	async record(input: RecordWashInput): Promise<string> {
		const key = SessionKeyManager.getKey();

		const now = new Date();
		const selectedDate = input.transactionDate;
		const isToday = !selectedDate || isSameUtcDay(selectedDate, now);

		// Para lavados históricos: normalizar a mediodía UTC de ese día.
		// Evita que un lavado "15 de marzo" se vea como 14 o 16 según la zona.
		const normalizedDate = selectedDate
			? new Date(
					Date.UTC(
						selectedDate.getUTCFullYear(),
						selectedDate.getUTCMonth(),
						selectedDate.getUTCDate(),
						12,
						0,
						0,
					),
				)
			: null;

		const customerSnapshotData: CustomerSnapshot = {
			displayName: input.customer.displayName,
			plate: input.customer.plate,
		};
		const encryptedSnapshot = await PrivacyVault.encryptPayload(
			customerSnapshotData,
			key,
		);

		const result = await runTransaction(this.runtime.db, async (tx) => {
			const customerRef = doc(
				this.runtime.db,
				this.customersPath,
				input.customer.customerId,
			);
			const customerSnap = await tx.get(customerRef);

			if (!customerSnap.exists()) {
				throw new Error("Customer disappeared mid-transaction");
			}

			const customerData = customerSnap.data();
			const currentWashes = customerData.accumulatedWashes as number;
			const newWashes = nextAccumulatedValue(currentWashes, input.wasFree);

			const updatePayload: Record<string, unknown> = {
				accumulatedWashes: newWashes,
			};

			if (isToday) {
				updatePayload.lastWashAt = serverTimestamp();
			} else {
				// Comparar contra el lastWashAt actual del doc. Si el retroactivo es
				// más antiguo que el último lavado conocido, no lo pisamos: el historial
				// refleja el lavado más reciente, no el que acabamos de cargar.
				const currentLastWashAt = customerData.lastWashAt as Timestamp | null;
				const candidateMs = normalizedDate!.getTime();
				const currentMs = currentLastWashAt ? currentLastWashAt.toDate().getTime() : 0;
				if (candidateMs > currentMs) {
					updatePayload.lastWashAt = Timestamp.fromDate(normalizedDate!);
				}
			}

			if (input.wasFree) {
				updatePayload.lastResetAt = serverTimestamp();
			}

			tx.update(customerRef, updatePayload);

			const txRef = doc(collection(this.runtime.db, this.transactionsPath));
			const txDoc: Omit<WashTransactionDocument, "createdAt"> = {
				transactionId: txRef.id,
				customerId: input.customer.customerId,
				customerSnapshot: encryptedSnapshot,
				vehicleKind: input.vehicleKind,
				serviceTier: input.serviceTier,
				cost: input.cost,
				wasFree: input.wasFree,
				paidWith: input.paidWith,
				registeredById: input.registeredBy.id,
				registeredByName: input.registeredBy.name,
				washerId: input.washer.id,
				washerName: input.washer.name,
				schemaVersion: 2,
			};

			tx.set(txRef, {
				...txDoc,
				createdAt: isToday
					? serverTimestamp()
					: Timestamp.fromDate(normalizedDate!),
			});

			return txRef.id;
		});

		return result;
	}

	/**
	 * Anula un lavado mal cargado. Borra el doc del ledger y devuelve el
	 * control al llamador para que recalcule la lealtad del cliente.
	 * La transacción no se reescribe: no existe, no se ve, no cuenta.
	 *
	 * No llamamos a recomputeLoyalty aquí a propósito: este repo no debe
	 * conocer CustomerRepository. El caller orquesta los dos.
	 */
	async annul(transactionId: string): Promise<void> {
		await deleteDoc(
			doc(this.runtime.db, this.transactionsPath, transactionId),
		);
	}

	async listRecent(limitCount = 50): Promise<WashTransactionView[]> {
		const q = query(
			collection(this.runtime.db, this.transactionsPath),
			orderBy("createdAt", "desc"),
			limit(limitCount),
		);
		const snap = await getDocs(q);
		return Promise.all(
			snap.docs.map((d) =>
				this.assembleTransactionView(d.data() as WashTransactionDocument),
			),
		);
	}

	subscribeRecent(
		limitCount: number,
		onChange: (transactions: WashTransactionView[]) => void,
	): () => void {
		const q = query(
			collection(this.runtime.db, this.transactionsPath),
			orderBy("createdAt", "desc"),
			limit(limitCount),
		);

		return onSnapshot(q, (snapshot: QuerySnapshot) => {
			Promise.all(
				snapshot.docs.map((d) =>
					this.assembleTransactionView(d.data() as WashTransactionDocument),
				),
			)
				.then((views) => onChange(views))
				.catch((err) => {
					console.error("[TransactionRepository] decrypt failure", err);
				});
		});
	}

	private async assembleTransactionView(
		docData: WashTransactionDocument & LegacyTransactionFields,
	): Promise<WashTransactionView> {
		const key = SessionKeyManager.getKey();
		const snapshot = (await PrivacyVault.decryptPayload(
			docData.customerSnapshot,
			key,
		)) as CustomerSnapshot;

		const createdAtRaw = docData.createdAt as unknown;
		let createdAt: Date;
		if (createdAtRaw instanceof Timestamp) {
			createdAt = createdAtRaw.toDate();
		} else if (createdAtRaw instanceof Date) {
			createdAt = createdAtRaw;
		} else if (typeof createdAtRaw === "number") {
			createdAt = new Date(createdAtRaw);
		} else {
			createdAt = new Date(0);
		}

		// Fallback defensivo para documentos schemaVersion 1: mapeamos el antiguo
		// 'operatorName' a ambos campos para que el historial legacy no muestre
		// "Desconocido" en las dos columnas.
		const stored = docData as StoredTransaction;
		const registeredByName = stored.registeredByName ?? stored.operatorName ?? "Desconocido";
		const washerName = stored.washerName ?? stored.operatorName ?? "Desconocido";

		return {
			transactionId: docData.transactionId,
			customerId: docData.customerId,
			customerName: snapshot.displayName,
			customerPlate: snapshot.plate,
			vehicleKind: docData.vehicleKind,
			serviceTier: docData.serviceTier,
			cost: docData.cost,
			wasFree: docData.wasFree,
			paidWith: docData.paidWith,
			registeredByName,
			washerName,
			createdAt,
		};
	}
}
