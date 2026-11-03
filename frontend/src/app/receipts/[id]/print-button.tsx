'use client'

export function PrintButton() {
  return <button type="button" className="btn-primary" onClick={() => window.print()}>Print / save as PDF</button>
}
