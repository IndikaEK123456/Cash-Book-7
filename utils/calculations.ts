
import { DailyData, PaymentMethod } from "../types";

export const calculateTotals = (data: DailyData) => {
  // 1. Out Party Section Totals (Rule 6, 7)
  const opCash = data.outPartyEntries
    .filter(e => e.method === PaymentMethod.CASH)
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  
  const opCard = data.outPartyEntries
    .filter(e => e.method === PaymentMethod.CARD)
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  
  const opPaypal = data.outPartyEntries
    .filter(e => e.method === PaymentMethod.PAYPAL)
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  // Rule 7 & 13: All out party amounts add to Main Section CASH IN
  const opTotalIn = opCash + opCard + opPaypal;
  
  // 2. Main Section Totals (Rule 10)
  // Rule 14: Main section card total = OP Card + Main Entries Card
  const mainCardOnly = data.mainEntries
    .filter(e => e.method === PaymentMethod.CARD)
    .reduce((sum, e) => sum + (Number(e.cashIn) || 0), 0);
  const mainCardTotal = opCard + mainCardOnly;

  const mainPaypalOnly = data.mainEntries
    .filter(e => e.method === PaymentMethod.PAYPAL)
    .reduce((sum, e) => sum + (Number(e.cashIn) || 0), 0);
  const mainPaypalTotal = opPaypal + mainPaypalOnly;

  // 3. Final Aggregates
  // Rule 13: Main Cash In = Opening + All Main In + OP Total
  const mainInRaw = data.mainEntries.reduce((sum, e) => sum + (Number(e.cashIn) || 0), 0);
  const mainCashInTotal = data.openingBalance + mainInRaw + opTotalIn;

  // Rule 15: Main Cash Out = sum(Main Out) + Card Total + PayPal Total
  const mainOutRaw = data.mainEntries.reduce((sum, e) => sum + (Number(e.cashOut) || 0), 0);
  const mainCashOutTotal = mainOutRaw + mainCardTotal + mainPaypalTotal;

  // Rule 16: Final Balance = Cash In Total - Cash Out Total
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
