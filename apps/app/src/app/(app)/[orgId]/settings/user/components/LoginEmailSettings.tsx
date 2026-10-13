'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@gideon-defender/ui/card';

interface Props {
  currentEmail: string;
}

export function LoginEmailSettings({ currentEmail }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Login Email</CardTitle>
        <CardDescription>{`You currently sign in as ${currentEmail}.`}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          Your login email is managed by Gideon, your organization&apos;s identity provider. To
          change it, update your email there or contact your organization administrator.
        </p>
      </CardContent>
    </Card>
  );
}
