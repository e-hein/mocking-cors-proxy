#!/bin/sh

tasksToKill=`lsof -i | grep -e 'node\s*[0-9]*.*(LISTEN)' | sed 's/node\s*\([0-9]*\).*/\1/g'`
for taskToKill in $tasksToKill
do
  title=`ps -aux | grep $taskToKill`
  echo ""
  echo "task found"
  echo $title
  echo "-> $taskToKill"
  kill $taskToKill
done