
import { RequestAnalyzer } from './RequestAnalyzer';

const analyzer = new RequestAnalyzer();
const plan = analyzer.analyze('Build an inventory management system');

console.log(JSON.stringify(plan, null, 2));

if (plan.projectType === 'full-stack-app' && plan.backendRequired === true && plan.databaseRequired === true) {
    console.log('Verification Passed!');
} else {
    throw new Error('Verification Failed!');
}
