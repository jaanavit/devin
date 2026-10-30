import path from "node:path";
import { createPaymentsServer } from "./server";
import { createFileRefundLog, prismaTransactionSource } from "./sources";

const port = Number(process.env.PAYMENTS_MOCK_PORT ?? 4100);
const token = process.env.PAYMENTS_MOCK_TOKEN ?? "";
if (!token) throw new Error("PAYMENTS_MOCK_TOKEN must be set");

const logFile = process.env.PAYMENTS_MOCK_LOG ?? path.resolve(process.cwd(), "logs/refunds.jsonl");
const refundLog = await createFileRefundLog(logFile);

createPaymentsServer({ transactions: prismaTransactionSource, refundLog, token }).listen(port, () => {
  console.log(`payments-mock listening on :${port} (refund log: ${logFile})`);
});
