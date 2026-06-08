
import * as admin from 'firebase-admin';
import firebaseConfig from './firebase-applet-config.json';

if (!admin.apps || admin.apps.length === 0) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: firebaseConfig.projectId,
    });
}

const db = admin.firestore();

async function checkJobs() {
    const jobs = await db.collection('build_jobs').orderBy('createdAt', 'desc').limit(5).get();
    jobs.forEach(doc => {
        console.log(`Job ID: ${doc.id}, Status: ${doc.data().status}, Progress: ${doc.data().progress}%`);
        console.log('Logs:', doc.data().logs.slice(-3));
    });
}

checkJobs().catch(console.error);
