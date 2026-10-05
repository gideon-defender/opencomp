import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Spinner } from './spinner';

describe('Spinner', () => {
  it('renders a status region with a default label and 12 bars', () => {
    const html = renderToStaticMarkup(<Spinner />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading"');
    expect(html.match(/loading-bar/g)?.length).toBe(12);
  });

  it('applies the size to the wrapper and the spinner variable', () => {
    const html = renderToStaticMarkup(<Spinner size={32} />);

    expect(html).toContain('--spinner-size:32px');
    expect(html).toContain('width:32px');
    expect(html).toContain('height:32px');
  });

  it('merges className and allows a custom label', () => {
    const html = renderToStaticMarkup(<Spinner className="my-loader" label="Saving" />);

    expect(html).toContain('my-loader');
    expect(html).toContain('aria-label="Saving"');
  });
});
