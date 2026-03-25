/**
 * Temporal Client — used by Foreman to start workflow executions.
 */

import { Client, Connection } from '@temporalio/client';

let _client: Client | null = null;

export async function getTemporalClient(): Promise<Client> {
  if (_client) return _client;
  const connection = await Connection.connect({ address: 'localhost:7233' });
  _client = new Client({ connection });
  return _client;
}
