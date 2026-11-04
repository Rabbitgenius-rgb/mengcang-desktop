export function visibleJobs(jobs) {
  const newest = [...jobs].reverse();
  return [...newest.filter(job => job.status !== 'saved'), ...newest.filter(job => job.status === 'saved').slice(0, 4)];
}
