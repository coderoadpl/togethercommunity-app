import { useEffect, useState } from 'react';
import { OutlinedInput } from '@mui/material';

export const useDebouncedValue = (value: string, delayMs = 250): string => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
};

export const matchesQuery = (query: string, ...haystacks: (string | null)[]): boolean => {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return true;
  return haystacks.some((value) => value !== null && value.toLocaleLowerCase().includes(needle));
};

export const SearchField = ({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  testId: string;
}) => (
  <OutlinedInput
    type="search"
    size="small"
    value={value}
    onChange={(event) => onChange(event.target.value)}
    placeholder={placeholder}
    inputProps={{ 'aria-label': placeholder, 'data-testid': testId }}
    sx={{ minWidth: { xs: '100%', sm: '15rem' } }}
  />
);
