
import { IEvent } from './IEvent';
import { EventType } from './EventTypes';

export type EventHandler = (event: IEvent) => Promise<void> | void;

export interface IEventBus {
    publish(event: IEvent): Promise<void>;
    subscribe(type: EventType, handler: EventHandler): string;
    unsubscribe(subscriptionId: string): void;
}
