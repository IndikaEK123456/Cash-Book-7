
import { DailyData, PaymentMethod } from "../types";

export const calculateTotals = (data: DailyData) => {
  // Defensive checks: Ensure we are working with arrays
  const opEntries = data?.outPartyEntries || [];
  const mainEntries = data?.mainEntries || [];

  // 1. Out Party Section Totals (Raw)
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
  
  // 2. Main Section Totals (Raw - just entries in this section)
  const mainCardOnly = mainEntries
    .filter(e => e?.method === PaymentMethod.CARD)
    .reduce((sum, e) => sum + (Number(e?.cashIn) || 0), 0);
  
  const mainPaypalOnly = mainEntries
    .filter(e => e?.method === PaymentMethod.PAYPAL)
    .reduce((sum, e) => sum + (Number(e?.cashIn) || 0), 0);

  // 3. Combined Aggregates (Out Party + Main Section)
  const mainCardTotal = opCard + mainCardOnly;
  const mainPaypalTotal = opPaypal + mainPaypalOnly;

  // 4. Final Aggregates for Liquidity
  const mainInRaw = mainEntries.reduce((sum, e) => sum + (Number(e?.cashIn) || 0), 0);
  const mainCashInTotal = (Number(data?.openingBalance) || 0) + mainInRaw + opTotalIn;

  const mainOutRaw = mainEntries.reduce((sum, e) => sum + (Number(e?.cashOut) || 0), 0);
  
  // Final Balance Logic: 
  // Total Cash In (Opening + Main In + All OutParty) 
  // minus Total Out (Main Out + Combined Card + Combined Paypal)
  const mainCashOutTotal = mainOutRaw + mainCardTotal + mainPaypalTotal;

  const finalBalance = mainCashInTotal - mainCashOutTotal;

  return {
    opCash,
    opCard,
    opPaypal,
    mainCardOnly,
    mainPaypalOnly,
    mainCardTotal,
    mainPaypalTotal,
    mainCashInTotal,
    mainCashOutTotal,
    finalBalance
  };
};
