import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";

interface PaginationControlProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

export function PaginationControl({ currentPage, totalPages, onPageChange }: PaginationControlProps) {
    return (
        <div className="flex items-center justify-end py-2">
            <div className="flex items-center gap-1.5">
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={currentPage <= 1}
                    onClick={() => onPageChange(currentPage - 1)}
                    className="rounded-lg h-8 w-8 p-0"
                >
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground/70 min-w-[60px] text-center font-medium">
                    {currentPage} / {totalPages || 1}
                </span>
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={currentPage >= totalPages}
                    onClick={() => onPageChange(currentPage + 1)}
                    className="rounded-lg h-8 w-8 p-0"
                >
                    <ArrowRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
