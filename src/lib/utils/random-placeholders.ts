/**
 * Returns a randomized sample name with a ~0.1% chance of easter-egg mention.
 */
export function getRandomSampleName(): string {
  if (typeof window !== 'undefined' && Math.random() < 0.001) {
    return 'Satya Nayak';
  }
  const names = [
    'Alex Rivera',
    'Rohan Sharma',
    'Priya Patel',
    'Jordan Lee',
    'Sarah Jenkins',
    'Vikram Malhotra',
    'Sneha Rao',
    'David Chen',
    'Ananya Verma',
    'Marcus Taylor',
  ];
  return names[Math.floor(Math.random() * names.length)];
}

/**
 * Returns randomized secondary email placeholder samples.
 */
export function getRandomSecondaryEmailPlaceholder(): string {
  if (typeof window !== 'undefined' && Math.random() < 0.001) {
    return 'satya@college.edu or satya@work.com';
  }
  const samples = [
    'alex@college.edu or alex@company.com',
    'priya@university.edu or priya@work.org',
    'rohan@alumni.edu or rohan@corp.io',
    'jordan@institute.edu or jordan@startup.co',
    'sneha@academic.edu or sneha@venture.com',
  ];
  return samples[Math.floor(Math.random() * samples.length)];
}
