/**
 * A path no route matches.
 *
 * A deleted review, project or ruleset does not land here: its id still
 * matches its page's route, and that page reads the 404 and offers the way
 * back (D-138). So the copy does not blame a deletion.
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
            Check the address, or start from Projects or Reviews.
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
