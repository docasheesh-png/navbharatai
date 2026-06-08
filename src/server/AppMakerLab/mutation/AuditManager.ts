export class AuditManager {
    log(transactionId: string, message: string) {
        console.log(`[AUDIT][${transactionId}] ${message}`);
    }
}
