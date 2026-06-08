import React, { useState } from 'react';
import { db } from '../App';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { AlertCircle } from 'lucide-react';

export const ReportProblemComponent = ({ errorContext, user }: { errorContext: any, user: any }) => {
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const report = async () => {
        if (!user) {
            alert('Please login to report issues.');
            return;
        }
        setSubmitting(true);
        try {
            await addDoc(collection(db, 'reports'), {
                error: JSON.stringify(errorContext),
                originalText: 'System Error Context',
                suggestion: 'Auto-reported system failure',
                userId: user.uid,
                userEmail: user.email,
                userName: user.displayName || user.email?.split('@')[0],
                timestamp: serverTimestamp(),
                comments: []
            });
            setSubmitted(true);
        } catch (e) {
            console.error(e);
        } finally {
            setSubmitting(false);
        }
    };

    if (submitted) return <span className="text-xs text-white text-center w-full">Report submitted!</span>;

    return (
        <button 
            onClick={report}
            disabled={submitting}
            className="flex-1 py-3 bg-[#161b22] hover:bg-[#21262d] text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-lg border border-white/10 flex items-center justify-center gap-2"
            title="Report this issue for analysis"
        >
            <AlertCircle className="w-4 h-4" />
            {submitting ? 'Reporting...' : 'Report'}
        </button>
    );
};
