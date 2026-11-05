export function ProfileCompletion({ completion }: { completion: { percent: number; missing: string[] } }) {
  return (
    <div className="card p-4" data-testid="profile-completion">
      <div className="flex items-center justify-between text-sm"><span className="font-medium">Profile {completion.percent}% complete</span>
        {completion.missing.length > 0 && <span className="text-xs text-slate-500">Missing: {completion.missing.join(', ')}</span>}</div>
      <div className="mt-2 h-2 rounded-full bg-slate-100" role="progressbar" aria-valuenow={completion.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completion">
        <div className="h-2 rounded-full bg-brand-600" style={{ width: `${completion.percent}%` }} /></div>
    </div>
  )
}
