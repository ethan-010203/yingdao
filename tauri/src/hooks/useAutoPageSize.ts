import { useState, useEffect, useCallback, RefObject } from "react";

/**
 * Dynamically calculates how many rows fit in the available container height.
 * Returns a pageSize that ensures zero scrolling — data is paginated instead.
 *
 * @param containerRef - ref to the element whose height determines available space
 * @param rowHeight - height of a single data row in px
 * @param minRows - minimum rows to show (default 3)
 */
export function useAutoPageSize(
    containerRef: RefObject<HTMLElement | null>,
    rowHeight: number,
    minRows = 3,
): number {
    const [pageSize, setPageSize] = useState(minRows);

    const calculate = useCallback(() => {
        if (!containerRef.current) return;
        const available = containerRef.current.clientHeight;
        const rows = Math.max(minRows, Math.floor(available / rowHeight));
        setPageSize(rows);
    }, [containerRef, rowHeight, minRows]);

    useEffect(() => {
        calculate();

        const el = containerRef.current;
        if (!el) return;

        const observer = new ResizeObserver(() => calculate());
        observer.observe(el);
        return () => observer.disconnect();
    }, [calculate, containerRef]);

    return pageSize;
}
