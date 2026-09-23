import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { currentMonth, monthLong, shiftMonth } from '../lib/format';

export function MonthStepper({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const atLatest = month >= currentMonth();
  return (
    <div className="stepper" role="group" aria-label="Choose month">
      <button className="btn btn-icon" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>
        <CaretLeftIcon size={16} weight="bold" />
      </button>
      <span className="stepper-label" aria-live="polite">
        {monthLong(month)}
      </span>
      <button
        className="btn btn-icon"
        aria-label="Next month"
        disabled={atLatest}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <CaretRightIcon size={16} weight="bold" />
      </button>
    </div>
  );
}
