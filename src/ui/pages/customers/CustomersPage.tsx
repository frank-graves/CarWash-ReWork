import { useSignal, useSignalEffect, useComputed } from '@preact/signals';
import { bootstrapFirebase } from '@infra/firebase-bootstrap';
import { Vault } from '@infra/vault';
import { CustomerRepository } from '@infra/customer-repository';
import { NewCustomerModal } from '../wash/NewCustomerModal';
import { EditCustomerModal } from './EditCustomerModal';
import { CustomerCard } from './CustomerCard';
import type { CustomerView } from '@core/types';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';
import styles from './CustomersPage.module.css';

export function CustomersPage() {
  const runtime = useSignal<FirebaseRuntime | null>(null);
  const workspaceId = useSignal<string | null>(null);
  const customers = useSignal<CustomerView[]>([]);
  const searchQuery = useSignal('');
  
  const showNewModal = useSignal(false);
  const editingCustomer = useSignal<CustomerView | null>(null);

  useSignalEffect(() => {
    bootstrapFirebase().then(async (rt) => {
      runtime.value = rt;
      const ws = await Vault.getWorkspaceId();
      workspaceId.value = ws;
    });
  });

  useSignalEffect(() => {
    if (!runtime.value || !workspaceId.value) return;
    const repo = new CustomerRepository(runtime.value, workspaceId.value);
    const unsubscribe = repo.subscribeAll((views) => {
      customers.value = views;
    });
    return unsubscribe;
  });

  const filteredCustomers = useComputed(() => {
    const q = searchQuery.value.trim().toLowerCase();
    if (!q) return customers.value;
    return customers.value.filter(c => 
      c.displayName.toLowerCase().includes(q) || 
      c.plate.toLowerCase().includes(q)
    );
  });

  // Sin parámetros a propósito: la suscripción ya refresca la lista, así que estos
  // callbacks solo cierran el modal. `noUnusedParameters` obliga a elegir entre
  // borrarlos o ensuciarlos con `_`; la firma sigue typechequeada por las props.
  const handleCreated = () => {
    showNewModal.value = false;
  };

  const handleUpdated = () => {
    editingCustomer.value = null;
  };

  return (
    <div class={styles.container}>
      <header class={styles.header}>
        <input
          type="text"
          class={styles.search}
          placeholder="Buscar por nombre o placa..."
          value={searchQuery.value}
          onInput={(e) => { searchQuery.value = e.currentTarget.value; }}
        />
        <button 
          type="button" 
          class={styles.btnNew}
          onClick={() => { showNewModal.value = true; }}
        >
          Nuevo cliente
        </button>
      </header>

      {filteredCustomers.value.length === 0 ? (
        <div class={styles.empty}>
          {customers.value.length === 0 
            ? 'Sin clientes todavía. El primero trabaja el doble.' 
            : 'Ningún cliente coincide con tu búsqueda.'}
        </div>
      ) : (
        <div class={styles.grid}>
          {filteredCustomers.value.map(c => (
            <CustomerCard 
              key={c.customerId} 
              customer={c} 
              onEdit={(cust) => { editingCustomer.value = cust; }}
            />
          ))}
        </div>
      )}

      {showNewModal.value && runtime.value && workspaceId.value && (
        <NewCustomerModal
          runtime={runtime.value}
          workspaceId={workspaceId.value}
          initialPlate=""
          onClose={() => { showNewModal.value = false; }}
          onCreated={handleCreated}
        />
      )}

      {editingCustomer.value && runtime.value && workspaceId.value && (
        <EditCustomerModal
          runtime={runtime.value}
          workspaceId={workspaceId.value}
          customer={editingCustomer.value}
          onClose={() => { editingCustomer.value = null; }}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}
