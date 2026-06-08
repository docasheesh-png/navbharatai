import { Pattern } from './PatternTypes';

export const PATTERN_LIBRARY: Pattern[] = [
    {
        id: 'web-standard',
        description: 'Standard Web Application',
        supportsFrontend: ['React', 'Next.js'],
        supportsBackend: ['Express', 'NestJS'],
        requiresDatabase: true,
        supportsRealtime: false,
        defaultStack: { frontend: 'React', backend: 'Express', database: 'PostgreSQL', orm: 'Prisma', auth: 'Firebase' }
    },
    {
        id: 'web-realtime',
        description: 'Real-time Web Application',
        supportsFrontend: ['React', 'Next.js'],
        supportsBackend: ['NestJS'],
        requiresDatabase: true,
        supportsRealtime: true,
        defaultStack: { frontend: 'Next.js', backend: 'NestJS', database: 'PostgreSQL', orm: 'Prisma', auth: 'Firebase', realtime: 'Socket.IO' }
    },
    {
        id: 'mobile-app',
        description: 'Native Mobile Application',
        supportsFrontend: ['React Native'],
        supportsBackend: ['NestJS'],
        requiresDatabase: true,
        supportsRealtime: true,
        defaultStack: { frontend: 'React Native', backend: 'NestJS', database: 'Firebase', auth: 'Firebase', realtime: 'Socket.IO' }
    }
];
