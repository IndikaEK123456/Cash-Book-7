
import { DailyData, PaymentMethod } from "../types";

export const calculateTotals = (data: DailyData) => {
  // Defensive checks: Ensure we are working with arrays
  const opEntries = data?.outPartyEntries || [];
  const mainEntries = data?.mainEntries || [];

  // 1. Out Party Section Totals
  const opCash = opEntries
    .filter(e => e?.method === PaymentMethod.CASH)
    .reduce((sum, e) => sum + (Number(e?.amount) || 0), 0);
  
  const opCard = opEntries
    .filter(e => e?.method === PaymentMethod.CARD)
    .reduce((sum, e) => sum + (Number(e?.amount) || 0), 0);
  
  const opPaypal = opEntries
    .filter(e => e?.method === PaymentMethod.PAYPAL)
    .reduce((sum, e) => sum + (Number(e?.amount) || 0), 0);

  // Rule 7 & 13: All out party amounts add to Main Section CASH IN
  const opTotalIn = opCash + opCard + opPaypal;
  
  // 2. Main Section Totals
  const mainCardOnly = mainEntries
    .filter(e => e?.method === PaymentMethod.CARD)
    .reduce((sum, e) => sum + (Number(e?.cashIn) || 0), 0);
  const mainCardTotal = opCard + mainCardOnly;

  const mainPaypalOnly = mainEntries
    .filter(e => e?.method === PaymentMethod.PAYPAL)
    .reduce((sum, e) => sum + (Number(e?.cashIn) || 0), 0);
  const mainPaypalTotal = opPaypal + mainPaypalOnly;

  // 3. Final Aggregates
  const mainInRaw = mainEntries.reduce((sum, e) => sum + (Number(e?.cashIn) || 0), 0);
  const mainCashInTotal = (Number(data?.openingBalance) || 0) + mainInRaw + opTotalIn;

  const mainOutRaw = mainEntries.reduce((sum, e) => sum + (Number(e?.cashOut) || 0), 0);
  const mainCashOutTotal = mainOutRaw + mainCardTotal + mainPaypalTotal;

  const finalBalance = mainCashInTotal - mainCashOutTotal;

  return {
    opCash,
    opCard,
    opPaypal,
    mainCardTotal,
    mainPaypalTotal,
    mainCashInTotal,
    mainCashOutTotal,
    finalBalance
  };
};
