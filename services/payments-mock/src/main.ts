import { createPaymentsServer } from "./server";

const port = Number(process.env.PAYMENTS_MOCK_PORT ?? 4100);
createPaymentsServer().listen(port, () => {
  console.log(`payments-mock listening on :${port}`);
});
