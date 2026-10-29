// Fill in a project's title, image, description and URL when its case study is ready.
// Empty images show TV static; empty URLs keep the project in this preview.
export const projects = Array.from({ length: 12 }, (_, index) => ({
  id: `project-${String(index + 1).padStart(2, '0')}`,
  title: `Project ${String(index + 1).padStart(2, '0')}`,
  subtitle: 'Case study coming soon',
  description: 'No signal — yet. This case study is coming soon.',
  image: null,
  url: null,
  seed: index + 1,
}));
