import React from "react";

// Custom scroller so the styled scrollbar lands on the actual scrollable
// element. By default react-virtuoso's `className` prop goes to the outer
// wrapper, not the scroller, so ::-webkit-scrollbar selectors miss.
export const ClipPreviewScroller = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function ClipPreviewScroller({ className, children, onWheel, ...rest }, ref) {
    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
      // Allow scrolling with Ctrl/Shift pressed by preventing browser zoom
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // Manually scroll the container
        const target = e.currentTarget;
        target.scrollTop += e.deltaY;
        return;
      }
      // Call original onWheel if provided
      onWheel?.(e);
    };

    return (
      <div
        {...rest}
        ref={ref}
        className={`clip-preview-grid-scroller${className ? ` ${className}` : ""}`}
        onWheel={handleWheel}
      >
        {children}
      </div>
    );
  },
);
