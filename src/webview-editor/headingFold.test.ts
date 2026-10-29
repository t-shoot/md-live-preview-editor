import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { headingSections } from './headingFold';

function sections(doc: string) {
	const state = EditorState.create({ doc, extensions: [markdown()] });
	return headingSections(state).map(section => ({
		title: section.title,
		body: state.sliceDoc(section.from, section.to),
	}));
}

describe('heading fold boundaries', () => {
	it('includes children until the next heading of the same or higher level', () => {
		const doc = '# Parent\n\nIntro\n\n## Child\nChild body\n\n### Grandchild\nDetails\n\n## Sibling\nOther\n\n# Next\nEnd';
		const result = sections(doc);
		expect(result.map(section => section.title)).toEqual(['Parent', 'Child', 'Grandchild', 'Sibling', 'Next']);
		expect(result[0].body).toContain('## Sibling\nOther');
		expect(result[0].body).not.toContain('# Next');
		expect(result[1].body).toContain('### Grandchild\nDetails');
		expect(result[1].body).not.toContain('## Sibling');
		expect(result[4].body).toBe('\nEnd');
	});

	it('ignores hashes in fenced code, frontmatter, quotes, and lists', () => {
		const doc = '---\n# YAML comment\ntitle: Example\n---\n\n# Real\n\n```md\n# In code\n```\n\n> # Quoted\n\n- # Listed\n\n## Child\nBody';
		expect(sections(doc).map(section => section.title)).toEqual(['Real', 'Child']);
	});

	it('omits empty sections and supports level six and closing hashes', () => {
		expect(sections('###### Empty\n\n###### Also empty\n\n###### Small ###\nBody\n\n# Last\n'))
			.toEqual([{ title: 'Small', body: '\nBody\n' }]);
	});

	it('finds the following heading even beyond the initially parsed viewport', () => {
		const body = 'A paragraph with some text.\n\n'.repeat(400);
		const result = sections(`# First\n\n${body}# Second\n\nLast paragraph`);
		expect(result.map(section => section.title)).toEqual(['First', 'Second']);
		expect(result[0].body).not.toContain('# Second');
	});
});
