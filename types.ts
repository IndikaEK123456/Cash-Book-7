
export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  PAYPAL = 'PAYPAL'
}

export enum DeviceRole {
  LAPTOP = 'laptop',
  MOBILE = 'mobile'
}

export interface OutPartyEntry {
  id: string;
  index: number;
  method: PaymentMethod;
  amount: number;
}

export interface MainEntry {
  id: string;
  roomNo: string;
  description: string;
  method: PaymentMethod;
  cashIn: number;
  cashOut: number;
}

export interface DailyData {
  date: string;
  outPartyEntries: OutPartyEntry[];
  mainEntries: MainEntry[];
  openingBalance: number;
}

export interface ExchangeRates {
  usd: number;
  euro: number;
}

export interface AppState {
  currentDay: DailyData;
  history: DailyData[];
  cabinId: string;
  rates: ExchangeRates;
  isPaired: boolean;
}
