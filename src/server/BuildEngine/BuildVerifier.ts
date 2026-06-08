
import { VerificationTarget } from './types';
import fs from 'fs';
import path from 'path';

export class BuildVerifier {
  verify(targets: VerificationTarget[]): boolean {
    for (const target of targets) {
      const filePath = path.resolve(process.cwd(), target.filePath);
      if (!fs.existsSync(filePath)) {
        console.error(`Verification failed: ${target.filePath} does not exist.`);
        return false;
      }
      
      const content = fs.readFileSync(filePath, 'utf-8');
      const forbidden = ['Generated manifest-driven file', 'TODO', 'placeholder', 'stub'];
      for (const pattern of forbidden) {
        if (content.includes(pattern)) {
          console.error(`Verification failed: ${target.filePath} contains forbidden content: ${pattern}`);
          return false;
        }
      }
      if (content.length < 20) {
        console.error(`Verification failed: ${target.filePath} is too small.`);
        return false;
      }
    }
    return true;
  }
}
