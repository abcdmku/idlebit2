// An unaffordable purchase says "Saving up", without predicting when it can be bought.

export function useSavingUp(price: number | null, affordable: boolean): string | null {
  if (affordable || price === null || price <= 0) return null;
  return 'Saving up';
}

/** The note for one offer, or nothing when it can be bought (or has no price). */
export function SavingUp({ price, affordable, className = 'dim' }: { price: number | null; affordable: boolean; className?: string }) {
  const text = useSavingUp(price, affordable);
  return text ? <span className={className}> · {text}</span> : null;
}
