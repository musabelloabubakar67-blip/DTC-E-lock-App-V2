'use client';

// Kit verification is queue-first like every mutating action except registration.
// ScanInputRow reports whether each value came from the camera or manual entry so
// the evidence tier follows the actual capture path.
import { useEffect, useState } from 'react';
import { IndustrialPageHeader, Panel, ScanInputRow } from '../_components/ProductUI';
import { submitVerification, type SubmitVerificationResult } from './actions';
import type { RecordKitVerificationFormValues } from '../../../lib/validations/verification';

type SourcedField = { serial: string; source: 'qr_scan' | 'manual' };

const emptySub: SourcedField = { serial: '', source: 'qr_scan' };

function SourcedInput({
  label,
  prefix,
  field,
  onChange,
  required,
}: {
  label: string;
  prefix: string;
  field: SourcedField;
  onChange: (next: SourcedField) => void;
  required?: boolean;
}) {
  return (
    <div className="verify-field">
      <ScanInputRow
        label={label}
        prefix={prefix}
        value={field.serial}
        placeholder="Scan or enter device serial"
        required={required}
        onChange={(serial, source) => onChange({ serial, source: source ?? field.source })}
      />
      {field.serial && (
        <span className="verify-field__source" data-source={field.source}>
          {field.source === 'qr_scan' ? 'Evidence: camera scan' : 'Evidence: manual entry'}
        </span>
      )}
    </div>
  );
}

export default function VerifyPage() {
  const [truckId, setTruckId] = useState('');
  const [mother, setMother] = useState<SourcedField>(emptySub);
  const [subs, setSubs] = useState<SourcedField[]>([{ ...emptySub }, { ...emptySub }, { ...emptySub }]);
  const [result, setResult] = useState<SubmitVerificationResult | { status: 'idle' }>({ status: 'idle' });

  useEffect(() => {
    const truck = new URLSearchParams(window.location.search).get('truck');
    if (truck) setTruckId(truck);
  }, []);

  function updateSub(index: number, next: SourcedField) {
    const nextSubs = [...subs];
    nextSubs[index] = next;
    setSubs(nextSubs);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult({ status: 'idle' });

    const scannedSubs = subs.filter((sub) => sub.serial.trim().length > 0);
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
            <span>Truck plate (optional - omit for a depot/off-truck check)</span>
            <input value={truckId} onChange={(event) => setTruckId(event.target.value)} placeholder="FZE998DI" />
          </label>

          <SourcedInput label="Mother lock" prefix="M" field={mother} onChange={setMother} required />

          {(['B', 'C', 'D'] as const).map((slot, index) => (
            <SourcedInput
              key={slot}
              label={`Sub-lock ${slot}`}
              prefix={slot}
              field={subs[index]}
              onChange={(next) => updateSub(index, next)}
            />
          ))}

          <button type="submit" className="btn btn--primary">
            Submit scan
          </button>
        </form>
      </Panel>

      {result.status === 'applied' && (
        <p className="banner banner--ok">
          {result.matched
            ? 'Verified against the current registry.'
            : 'Verified and corrected against physical reality. Matching reviews were updated.'}
        </p>
      )}
      {result.status === 'queued' && <p className="banner banner--ok">Saved on device - pending sync.</p>}
      {result.status === 'error' && <p className="banner banner--error">{`Error: ${result.message}`}</p>}
    </main>
  );
}
