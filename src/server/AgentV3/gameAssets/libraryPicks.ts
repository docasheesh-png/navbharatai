// The library-pick vocabulary lives with the kit generators (src/server/lib/libraryPicks.ts): a kit generator must import
// only from src/server/lib, so the kit-history command can bundle it without the server's dependency tree (#4618 CI).
export * from '../../lib/libraryPicks';
