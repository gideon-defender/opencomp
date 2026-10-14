import { schedules } from '@gideon-defender/trigger-local';
import { CandidateScreeningDispatchService } from '../../background-checks/candidate-screening-dispatch.service';
import { getTriggerService } from '../nest-context';

export const dispatchCandidateScreeningsSchedule = schedules.task({
  id: 'dispatch-candidate-screenings-schedule',
  cron: '* * * * *',
  maxDuration: 1000 * 60 * 25,
  run: async () =>
    getTriggerService(CandidateScreeningDispatchService).runPending(),
});
