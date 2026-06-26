
export class AppMakerError extends Error {
    constructor(public message: string, public code: string) {
        super(message);
        this.name = 'AppMakerError';
    }
}

export class NotFoundError extends AppMakerError {
    constructor(message: string) {
        super(message, 'NOT_FOUND');
    }
}

export class ValidationError extends AppMakerError {
    constructor(message: string) {
        super(message, 'VALIDATION_ERROR');
    }
}

export class PersistenceError extends AppMakerError {
    constructor(message: string) {
        super(message, 'PERSISTENCE_ERROR');
    }
}
