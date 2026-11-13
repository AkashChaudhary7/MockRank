import React from 'react';
import { Scale, X } from 'lucide-react';

interface LegalModalProps {
  onClose: () => void;
}

export const LegalModal: React.FC<LegalModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-3xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-slate-900" />
            <h2 className="text-lg font-bold text-slate-900">
              Legal Disclosures, Privacy, Refund Policy & Terms
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 border border-slate-200 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs sm:text-sm text-slate-700 leading-relaxed">
          <section className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <h3 className="font-bold text-slate-900 mb-1">
              Independent Platform Disclaimer (Non-Affiliation Notice)
            </h3>
            <p>
              <strong>MockRank</strong> is an independent competitive examination preparation and
              simulation platform. MockRank is <strong>NOT affiliated with, endorsed by, or
              connected to the Delhi Subordinate Services Selection Board (DSSSB)</strong> or any
              government authority. All mock tests, blueprints, and provisional rankings are
              designed strictly for candidate practice and self-assessment.
            </p>
          </section>

          <section>
            <h3 className="font-bold text-slate-900 mb-1">1. Terms and Conditions</h3>
            <p>
              Each enrolled candidate is permitted one official scored attempt per mock test in the
              21-Day Challenge. Daily mocks unlock at 12:00 AM IST (Asia/Kolkata) starting from the
              configured challenge start date. Any attempt to manipulate client timers, scrape
              questions, or share accounts may result in attempt invalidation by administrators.
            </p>
          </section>

          <section>
            <h3 className="font-bold text-slate-900 mb-1">2. Privacy & Data Retention Policy</h3>
            <p>
              We collect only essential candidate information required for authentication,
              entitlement verification, and rank computation: your name, verified email address,
              optional profile photo URL, and examination attempt responses. Private PII (`email`)
              is strictly isolated inside `/users/{'{uid}'}` and is never exposed on public
              leaderboards. Candidates may permanently delete their profile data at any time from
              the Profile page.
            </p>
          </section>

          <section>
            <h3 className="font-bold text-slate-900 mb-1">
              3. Payment Disclosures & Refund Policy
            </h3>
            <p>
              Payments for the ₹9 21-Day Challenge and Lifetime Premium are processed securely via
              Razorpay. Because digital mock examination access is provisioned immediately upon
              cryptographic signature verification, fees for attempted mocks are non-refundable. In
              case of duplicate deductions or technical billing failure prior to attempting any
              mock, candidates may request a full refund within 7 days of transaction capture.
            </p>
          </section>

          <section>
            <h3 className="font-bold text-slate-900 mb-1">4. Contact & Grievance Support</h3>
            <p>
              For technical support, payment reconciliation, or account assistance, contact the
              MockRank Examination Helpdesk at{' '}
              <span className="font-mono text-slate-900">support@mockrank.in</span> (Operating
              Hours: 09:00 AM – 07:00 PM IST, Monday to Saturday).
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
