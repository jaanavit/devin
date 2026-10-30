-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");

-- CreateIndex
CREATE INDEX "Transaction_merchant_createdAt_idx" ON "Transaction"("merchant", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_amountCents_idx" ON "Transaction"("amountCents");

-- CreateIndex
CREATE INDEX "Transaction_deviceId_idx" ON "Transaction"("deviceId");

-- CreateIndex
CREATE INDEX "Transaction_cardFingerprint_idx" ON "Transaction"("cardFingerprint");
