'use client';

// §3 Kit verification — the byproduct-of-work trust model. Prompted any time a tech interacts
// with a truck (install, fault, movement, depot lookup); this page is the first place in the
// app that can actually submit a kit scan. Queue-first (§4/§9) like every mutating action
// except registration — so the result is "saved on device, pending sync," never a live
// match/mismatch verdict (that only exists once the sync engine actually applies it).
//
// Source per device (qr_scan vs manual) is captured explicitly per §3's tiering model — kit
// trust is the WEAKEST tier present, so this can't be inferred after the fact; it has to be
// recorded at entry time. A plain source selector (not automatic scan-mode detection) keeps
// this page self-contained without changing ProductUI's shared ScanInputRow.
import { useState } from 'react';
import { IndustrialPageHeader, Panel } from '../_components/ProductUI';
import { submitVerification, type SubmitVerificationResult } from './actions';
import type { RecordKitVerificationFormValues } from '../../../lib/validations/verification';

type SourcedField = { serial: string; source: 'qr_scan' | 'manual' };

const emptySub: SourcedField = { serial: '', source: 'qr_scan' };

function SourcedInput({
  label,
  field,
  onChange,
  required,
}: {
  label: string;
  field: SourcedField;
  onChange: (next: SourcedField) => void;
  required?: boolean;
}) {
  return (
    <div className="verify-field">
      <label>
        <span>{label}</span>
        <input
          value={field.serial}
          onChange={(e) => onChange({ ...field, serial: e.target.value })}
          placeholder="Scan or type the serial"
          required={required}
        />
      </label>
      <div className="verify-field__source" role="radiogroup" aria-label={`${label} source`}>
        <label>
          <input
            type="radio"
            name={`${label}-source`}
            checked={field.source === 'qr_scan'}
            onChange={() => onChange({ ...field, source: 'qr_scan' })}
          />
          Scanned
        </label>
        <label>
          <input
            type="radio"
            name={`${label}-source`}
            checked={field.source === 'manual'}
            onChange={() => onChange({ ...field, source: 'manual' })}
          />
          Typed (manual — lower confidence)
        </label>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  const [truckId, setTruckId] = useState('');
  const [mother, setMother] = useState<SourcedField>(emptySub);
  const [subs, setSubs] = useState<SourcedField[]>([{ ...emptySub }, { ...emptySub }, { ...emptySub }]);
  const [result, setResult] = useState<SubmitVerificationResult | { status: 'idle' }>({ status: 'idle' });

  function updateSub(index: number, next: SourcedField) {
    const nextSubs = [...subs];
    nextSubs[index] = next;
    setSubs(nextSubs);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult({ status: 'idle' });

    const scannedSubs = subs.filter((s) => s.serial.trim().length > 0);
    const values: RecordKitVerificationFormValues = {
      truckId: truckId || undefined,
      motherSerial: mother.serial,
      motherSource: mother.source,
      subs: scannedSubs,
    };

    const outcome = await submitVerification(values);
    setResult(outcome);
    if (outcome.status === 'queued' || outcome.status === 'applied') {
      setTruckId('');
      setMother(emptySub);
      setSubs([{ ...emptySub }, { ...emptySub }, { ...emptySub }]);
    }
  }

  return (
    <main className="verify-cockpit">
      <IndustrialPageHeader
        eyebrow="Registry versus physical state"
        title="Verify"
        accent="Kit"
        metric="SCAN"
        description="Scan the physical kit, preserve source evidence and resolve matching registry reviews."
      />

      <Panel title="Kit scan">
        <form onSubmit={handleSubmit}>
          <label>
            <span>Truck plate (optional — omit for a depot/off-truck check)</span>
            <input value={truckId} onChange={(e) => setTruckId(e.target.value)} placeholder="FZE998DI" />
          </label>

          <SourcedInput label="Mother lock" field={mother} onChange={setMother} required />

          {(['B', 'C', 'D'] as const).map((slot, i) => (
            <SourcedInput key={slot} label={`Sub-lock ${slot}`} field={subs[i]} onChange={(next) => updateSub(i, next)} />
          ))}

          <button type="submit" className="btn btn--primary">
            Submit scan
          </button>
        </form>
      </Panel>

      {result.status === 'applied' && (
        <p className="banner banner--ok">
          {result.matched ? 'Verified against the current registry.' : 'Verified and corrected against physical reality. Matching reviews were updated.'}
        </p>
      )}
      {result.status === 'queued' && <p className="banner banner--ok">Saved on device - pending sync.</p>}
      {result.status === 'error' && <p className="banner banner--error">{`Error: ${result.message}`}</p>}
    </main>
  );
}
