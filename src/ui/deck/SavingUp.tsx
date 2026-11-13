// An unaffordable purchase says "Saving up", without predicting when it can be bought.

export function useSavingUp(price: number | null, affordable: boolean): string | null {
  if (affordable || price === null || price <= 0) return null;
  return 'Saving up';
}
