// src/infra/transaction-repository.ts
// El libro mayor de lavados (washLedger). Inmutable por diseño:
// una transacción registrada nunca se modifica, solo se añaden nuevas.

import {
	collection,
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
				lastWashAt: serverTimestamp(),
			};
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
				createdAt: serverTimestamp(),
			});

			return txRef.id;
		});

		return result;
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
