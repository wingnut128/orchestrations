export interface ChangedFile {
	path: string;
	status: string;
	additions: number;
	deletions: number;
}

export interface PullRequestContext {
	meta: {
		owner: string;
		repo: string;
		pr: number;
		title: string;
		headSha: string;
		baseSha: string;
		author: string;
	};
	diff: string;
	changedFiles: ChangedFile[];
	/** Absolute path of the checked-out PR head. */
	workingDir: string;
}
