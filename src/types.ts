export interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date | string;
}
