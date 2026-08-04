/**
 * A URL that names nothing.
 *
 * Most often a bookmarked review that has since been deleted, so the copy
 * says that rather than the usual shrug: the app deletes reviews on purpose
 * and a dead link is the expected aftermath, not a fault.
 */

import Link from "next/link";
import { PageBody, PageHeader } from "@/components/page";
import { Button, Card } from "@/components/ui";

export default function NotFound() {
  return (
    <>
      <PageHeader title="Nothing lives at this address" />
      <PageBody>
        <Card className="max-w-2xl p-4">
          <p className="text-sm text-[var(--color-ink-muted)]">
            The page may name a review, project or ruleset that has since been deleted. Deleting one
            removes its worktrees, bundle and logs; an exported report outlives all of that and
            stays under your data directory.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/projects">
              <Button variant="primary">Projects</Button>
            </Link>
            <Link href="/reviews">
              <Button variant="quiet">Reviews</Button>
            </Link>
          </div>
        </Card>
      </PageBody>
    </>
  );
}
