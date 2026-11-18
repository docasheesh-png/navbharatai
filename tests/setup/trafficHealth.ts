// Process health intentionally survives requests. Each test starts a fresh simulated process.
import { beforeEach } from 'vitest';
import { resetTrafficHealthForTests } from '../../src/server/AI/ProviderHealth/trafficHealth';
beforeEach(() => resetTrafficHealthForTests());
