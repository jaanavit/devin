import type { Db, PrismaClient } from "@fintech/models";

export type DbClient = PrismaClient | Db;

/** Runs `fn` in a transaction, or inline if `db` is already a transaction client. */
export async function inTransaction<T>(db: DbClient, fn: (tx: Db) => Promise<T>): Promise<T> {
  return "$transaction" in db ? db.$transaction(fn) : fn(db);
}
