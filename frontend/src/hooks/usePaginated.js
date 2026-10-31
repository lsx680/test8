import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 分页列表 hook（对齐契约分页规范：page 从 1 开始、pageSize 默认 20、上限 100）
 * fetcher(params) 需返回 { list, total, page, pageSize }
 *
 * @param {(params:object)=>Promise<any>} fetcher
 * @param {{ initialFilters?:object, pageSize?:number, auto?:boolean }} options
 */
export function usePaginated(fetcher, options = {}) {
  const { initialFilters = {}, pageSize: initialPageSize = 20, auto = true } = options;

  const [filters, setFiltersState] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [data, setData] = useState({ list: [], total: 0 });
  const [loading, setLoading] = useState(auto);
  const [error, setError] = useState(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const filterKey = JSON.stringify(filters);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, pageSize };
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== '' && value !== null && value !== undefined) params[key] = value;
      });
      const result = await fetcherRef.current(params);
      if (Array.isArray(result)) {
        setData({ list: result, total: result.length });
      } else {
        setData({ list: result?.list || [], total: Number(result?.total) || 0 });
      }
    } catch (err) {
      setError(err?.displayMessage || err?.message || '列表加载失败');
      setData({ list: [], total: 0 });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, filterKey]);

  useEffect(() => {
    if (auto) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  /** 修改筛选条件时回到第 1 页 */
  const setFilters = useCallback((next) => {
    setFiltersState((prev) => (typeof next === 'function' ? next(prev) : next));
    setPage(1);
  }, []);

  const resetFilters = useCallback((next = {}) => {
    setFiltersState(next);
    setPage(1);
  }, []);

  const setPageSize = useCallback((size) => {
    setPageSizeState(size);
    setPage(1);
  }, []);

  return {
    list: data.list,
    total: data.total,
    page,
    pageSize,
    filters,
    loading,
    error,
    setPage,
    setPageSize,
    setFilters,
    resetFilters,
    reload: load,
  };
}

export default usePaginated;