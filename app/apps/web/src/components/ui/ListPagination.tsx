import { useEffect, useState } from 'react';
import { TablePagination } from '@mui/material';

import { useTranslations } from '../../i18n/index.js';

const MIN_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [MIN_PAGE_SIZE, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;

export interface PagedList<T> {
  pageItems: T[];
  count: number;
  page: number;
  rowsPerPage: number;
  setPage: (page: number) => void;
  setRowsPerPage: (rowsPerPage: number) => void;
}

export const usePagedList = <T,>(items: T[], filterKey: string): PagedList<T> => {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [filterKey]);

  const lastPage = Math.max(0, Math.ceil(items.length / rowsPerPage) - 1);
  const currentPage = Math.min(page, lastPage);

  return {
    pageItems: items.slice(currentPage * rowsPerPage, (currentPage + 1) * rowsPerPage),
    count: items.length,
    page: currentPage,
    rowsPerPage,
    setPage,
    setRowsPerPage: (next) => {
      setRowsPerPage(next);
      setPage(0);
    },
  };
};

export const ListPagination = <T,>({ paged, testId }: { paged: PagedList<T>; testId: string }) => {
  const t = useTranslations();

  if (paged.count <= MIN_PAGE_SIZE) return null;

  return (
    <TablePagination
      component="div"
      data-testid={testId}
      count={paged.count}
      page={paged.page}
      rowsPerPage={paged.rowsPerPage}
      rowsPerPageOptions={PAGE_SIZE_OPTIONS}
      onPageChange={(_event, nextPage) => paged.setPage(nextPage)}
      onRowsPerPageChange={(event) => paged.setRowsPerPage(Number.parseInt(event.target.value, 10))}
      labelRowsPerPage={t.pagination.rowsPerPage}
      labelDisplayedRows={({ from, to, count }) => t.pagination.displayedRows({ from, to, count })}
      getItemAriaLabel={(type) =>
        type === 'first'
          ? t.pagination.firstPage
          : type === 'last'
            ? t.pagination.lastPage
            : type === 'next'
              ? t.pagination.nextPage
              : t.pagination.previousPage
      }
    />
  );
};
