/**
 * Imported FIRST by server.ts (right after dotenv): installs the AI provider switches' network layer before any
 * module creates an SDK client, because an SDK keeps the `fetch` it saw when it was constructed. See
 * providerSwitches.ts. Nothing is switched off until the first sync reads the shared state.
 */
import { installProviderSwitchGuard } from './providerSwitches';

installProviderSwitchGuard();
