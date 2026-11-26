#!/usr/bin/env zsh
# Manual multi-agent dibs scenario helper. Usage: run-scenario.sh <cmd> <scenario> [args]
set -euo pipefail; setopt null_glob
cmd=${1:?usage: run-scenario.sh setup|agent|say|watch|collect|teardown N [args]}; N=${2:?scenario name}; shift 2
ROOT=${DIBS_E2E_ROOT:-~/.cache/dibs-ui/e2e}/$N; ROOT=${~ROOT}
W=$ROOT/work E=$ROOT/evidence
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
pdibs() { (cd $W && DIBS_TRUST=1 DIBS_HOME=$ROOT/home $ROOT/bin/dibs "$@"); }

case $cmd in
setup)
  [[ -e $ROOT ]] && { echo "exists: $ROOT" >&2; exit 1; }
  mkdir -p $ROOT/{home,bin,evidence,work,agents}
  if [[ ${DIBS_VERSION:?set DIBS_VERSION (or local)} == local ]]; then
    # Build and pack this checkout; packing rewrites workspace:* so Pi gets the local core, not the registry one.
    repo=${0:A:h:h:h:h:h}; (cd $repo && nub run build >/dev/null)
    for d in packages/dibs plugins/pi; do (cd $repo/$d && nub pack --pack-destination $ROOT/tgz >/dev/null); done
    (cd $ROOT && npm i --silent --prefix pkg $ROOT/tgz/*.tgz)
  else
    (cd $ROOT && npm i --silent --prefix pkg @dibs.ai/dibs@$DIBS_VERSION @dibs.ai/pi@$DIBS_VERSION)
  fi
  ln -s $ROOT/pkg/node_modules/.bin/dibs $ROOT/bin/dibs
  printf 'export DIBS_TRUST=1 DIBS_HOME=%s\nexport PATH=%s/bin:$PATH\n' $ROOT/home $ROOT > $ROOT/env.sh
  mk() { DIBS_SESSION=orchestrator pdibs create "$@" | sed -E 's/^Created task ([^ ]+).*/\1/'; }
  a=$(mk "$N: create $N-a.txt containing the line 'A done'")
  b=$(mk "$N: run: test -f $N-a.txt && echo 'B done' >> $N-a.txt" --blocked-by $a)
  printf 'A=%s\nB=%s\n' $a $b | tee $ROOT/ids ;;
agent)
  name=${1:?NAME}; model=${2:?MODEL}
  PI_EXT=${PI_EXT:-$ROOT/pkg/node_modules/@dibs.ai/pi/index.ts} DIBS_SKILL=${DIBS_SKILL:-$ROOT/pkg/node_modules/@dibs.ai/dibs/skills/dibs}
  touch $ROOT/agents/$name.start
  sid=$(rex new $N-$name --keep-open --json -- zsh -c "cd $W && source $ROOT/env.sh && export DIBS_SESSION=$name && pi --model $model --thinking low --session-dir $ROOT/agents/$name-pi --no-extensions -e $PI_EXT --no-skills --skill $DIBS_SKILL" | jq -r .session_id)
  blk=$(rex session inspect $sid --json | jq -r '.windows[0].focused_block_id')
  echo "$sid $blk" > $ROOT/agents/$name; cat $ROOT/agents/$name ;;
say)
  name=${1:?NAME}; read sid blk < $ROOT/agents/$name
  rex send -s $sid -b $blk "${2:?prompt}" && rex send-key -s $sid -b $blk enter
  echo "$(now) $name: $2" >> $E/prompts.log ;;
watch)
  prev=
  while true; do
    cur=$(pdibs --json list | jq -c '[.[]|select(.name|startswith("'$N':"))|{id,completed,started_at,claimed_by}]' 2>/dev/null || true)
    [[ -n $cur && $cur != $prev ]] && { echo "$(now) $cur" >> $E/store.log; prev=$cur; }
    sleep 1
  done ;;
collect)
  . $ROOT/ids
  {
  cp $W/$N-a.txt $E/ 2>/dev/null || true
  logs=()
  for m in $ROOT/agents/*.start; do
    name=${m:t:r}
    f=$(ls -t $ROOT/agents/$name-pi/**/*.jsonl 2>/dev/null | head -1 || true)
    [[ -z $f ]] && { echo "no pi log for $name"; continue; }
    logs+=$f
    jq -r 'select(.type=="message") | .timestamp as $t | .message as $m | (if ($m.content|type)=="string" then [{text:$m.content}] else ($m.content // []) end)[] |
      "\($t) \($m.role) " + (if .name then "tool \(.name) \(.arguments|tostring)" else (.text // "") end | gsub("\n";" ") | .[0:300])' $f > $E/$name-tools.log
  done
  ok() { if eval "$1"; then echo "PASS: $2"; else echo "FAIL: $2"; fi; }
  ok '[[ "$(cat $W/$N-a.txt 2>/dev/null)" == $'"'"'A done\nB done'"'"' ]]' "final file is exactly 'A done\\nB done\\n'"
  ta=$(grep -m1 "\"id\":\"$A\"[^}]*\"completed\":true" $E/store.log 2>/dev/null | cut -d' ' -f1 || true)
  bs=$(pdibs --json list 2>/dev/null | jq -r ".[]|select(.id==\"$B\")|.started_at // empty" 2>/dev/null || true)
  if [[ -z $ta || -z $bs ]]; then echo "UNKNOWN: B.started_at > A completion (A=${ta:-?} B=${bs:-?})"
  else ok '[[ $bs > $ta ]]' "B.started_at $bs > A completed $ta"; fi
  ok '! grep -qE "force\\\\?\":true|--force" $E/*-tools.log /dev/null' "no force usage"
  ok '! grep -qE "tool .*(todos\\.jsonl|npx)" $E/*-tools.log /dev/null' "no todos.jsonl / npx in tool calls"
  if [[ -f $W/plan.md ]]; then  # scenario 5: task links in a Markdown file
    cp $W/plan.md $E/
    ok 'grep -qE "\]\(dibs://[^/]+/$B\)" $W/plan.md' "plan.md has a Markdown dibs:// link to B"
    ok '[[ $(grep -cE "tool todo_resolve .*dibs://" $E/*-tools.log /dev/null | awk -F: "{s+=\$NF} END {print s}") -ge 2 ]]' "todo_resolve called on a dibs:// link at least twice"
    ok 'grep -qE "tool todo_link " $E/*-tools.log /dev/null' "todo_link used to write the link"
  fi
  } | tee $E/checks.txt
  # Dated report with the evidence inline; verdict and notes are added by hand.
  rep=${0:A:h}/results/$(date -u +%Y-%m-%dT%H%M%SZ)-$N.md; mkdir -p ${rep:h}
  { echo "# Scenario $N, $(date -u +%F)"; echo; echo "Package: \`$(jq -r .version $ROOT/pkg/node_modules/@dibs.ai/dibs/package.json)\`. Tasks: A \`$A\`, B \`$B\`."; echo; echo "Verdict: _fill in_"
    for f in checks.txt prompts.log store.log *-tools.log $N-a.txt plan.md; do [[ -f $E/$f ]] && printf '\n## %s\n\n```text\n%s\n```\n' $f "$(<$E/$f)"; done
  } > $rep; echo "report: $rep" ;;
teardown)
  for f in $ROOT/agents/*(.); do [[ $f == *.start ]] || rex kill ${$(<$f)%% *}; done ;;
*) echo "unknown cmd $cmd" >&2; exit 1 ;;
esac
