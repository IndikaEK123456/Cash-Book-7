
import { DailyData, PaymentMethod } from "../types";

export const calculateTotals = (data: DailyData) => {
  // 1. Out Party Totals
  const opCash = data.outPartyEntries
    .filter(e => e.method === PaymentMethod.CASH)
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  
  const opCard = data.outPartyEntries
    .filter(e => e.method === PaymentMethod.CARD)
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  
  const opPaypal = data.outPartyEntries
    .filter(e => e.method === PaymentMethod.PAYPAL)
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  // Rule 7 & 13: All Out Party methods contribute to Main Cash In
  const opTotalIn = opCash + opCard + opPaypal;
  
  // 2. Main Section Raw Entries
  const mainCashInRaw = data.mainEntries.reduce((sum, e) => sum + (Number(e.cashIn) || 0), 0);
  const mainCashOutRaw = data.mainEntries.reduce((sum, e) => sum + (Number(e.cashOut) || 0), 0);

  // Rule 14: Main Card/Paypal Totals = OP Total + Main Entry Card/Paypal In
  const mainCardSub = data.mainEntries
    .filter(e => e.method === PaymentMethod.CARD)
    .reduce((sum, e) => sum + (Number(e.cashIn) || 0), 0);
  const mainCardTotal = opCard + mainCardSub;

  const mainPaypalSub = data.mainEntries
    .filter(e => e.method === PaymentMethod.PAYPAL)
    .reduce((sum, e) => sum + (Number(e.cashIn) || 0), 0);
  const mainPaypalTotal = opPaypal + mainPaypalSub;

  // Rule 13: Total Cash In = Opening Balance + Main In Raw + Out Party Totals
  const mainCashInTotal = data.openingBalance + mainCashInRaw + opTotalIn;

  // Rule 15: Main Cash Out Total = Main Out Raw + All Card Totals + All PayPal Totals
  const mainCashOutTotal = mainCashOutRaw + mainCardTotal + mainPaypalTotal;

  // Rule 16: Final Balance = Cash In Total - Cash Out Total
  const finalBalance = mainCashInTotal - mainCashOutTotal;

  return {
    opCash,
    opCard,
    opPaypal,
    mainCashInTotal,
    mainCashOutTotal,
    mainCardTotal,
    mainPaypalTotal,
    finalBalance
  };
};
