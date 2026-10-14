# Preserve the task's RDS CA/bootstrap wrapper. A shell entrypoint consumes ONE
# command string; separate Node argv would launch bare Node and exit zero.
.containerDefinitions | map(select(.name == "migrator")) |
if length != 1 then error("Expected exactly one migrator container") else .[0] end |
. as $container | (.entryPoint // []) as $entry |
["node", "packages/db/scripts/staged-migrate.mjs", $phase] as $argv |
if ($entry | length) == 0 then $argv
elif ($entry | length) == 2
  and (["/bin/sh", "sh", "/bin/bash", "bash"] | index($entry[0])) != null
  and (["-c", "-ec", "-ce"] | index($entry[1])) != null then
  "exec ./node_modules/.bin/prisma migrate deploy" as $tail |
  ($container.command // []) as $command |
  if ($command | length) != 1 or ($command[0] | endswith($tail) | not) then
    error("Unsupported migrator bootstrap command; refusing a possible migration no-op")
  else [($command[0] | rtrimstr($tail)) + "exec " + ($argv | join(" "))] end
else error("Unsupported migrator entrypoint; refusing a possible migration no-op") end |
{containerOverrides: [{name: "migrator", command: .}]}
