'use strict'

/**
 * @param {object} sqsAlarmsConfig The fully resolved alarm configuration
 */
module.exports = function sqsAlarms (sqsAlarmsConfig, context) {
  return {
    createSQSAlarms
  }

  /**
   * Add all required SQS alarms to the provided CloudFormation template
   * based on the SQS resources found within
   *
   * @param {CloudFormationTemplate} cfTemplate A CloudFormation template object
   */
  function createSQSAlarms (cfTemplate) {
    const queueResources = cfTemplate.getResourcesByType(
      'AWS::SQS::Queue'
    )

    for (const [queueResourceName, queueResource] of Object.entries(
      queueResources
    )) {
      if (sqsAlarmsConfig.InFlightMessagesPc.enabled) {
        const inFlightMsgsAlarm = createInFlightMsgsAlarm(
          queueResourceName,
          queueResource,
          sqsAlarmsConfig.InFlightMessagesPc
        )
        cfTemplate.addResource(inFlightMsgsAlarm.resourceName, inFlightMsgsAlarm.resource)
      }

      if (sqsAlarmsConfig.AgeOfOldestMessage.enabled) {
        if (sqsAlarmsConfig.AgeOfOldestMessage.Threshold == null) {
          throw new Error('SQS AgeOfOldestMessage alarm is enabled but `Threshold` is not specified. Please specify a threshold or disable the alarm.')
        }

        const oldestMsgAgeAlarm = createOldestMsgAgeAlarm(
          queueResourceName,
          queueResource,
          sqsAlarmsConfig.AgeOfOldestMessage
        )
        cfTemplate.addResource(
          oldestMsgAgeAlarm.resourceName,
          oldestMsgAgeAlarm.resource
        )
      }
    }
  }

  function createSqsAlarm (
    alarmName,
    alarmDescription,
    queueName,
    comparisonOperator,
    threshold,
    metricName,
    statistic,
    period,
    evaluationPeriods,
    treatMissingData
  ) {
    const metricProperties = {
      Dimensions: [{ Name: 'QueueName', Value: queueName }],
      MetricName: metricName,
      Namespace: 'AWS/SQS',
      Period: period,
      Statistic: statistic
    }

    return {
      Type: 'AWS::CloudWatch::Alarm',
      Properties: {
        ActionsEnabled: true,
        AlarmActions: context.alarmActions,
        AlarmName: alarmName,
        AlarmDescription: alarmDescription,
        EvaluationPeriods: evaluationPeriods,
        ComparisonOperator: comparisonOperator,
        Threshold: threshold,
        TreatMissingData: treatMissingData,
        ...metricProperties
      }
    }
  }

  function createInFlightMsgsAlarm (logicalId, queueResource, config) {
    const threshold = config.Threshold

    // TODO: verify if there is a way to reference these hard limits directly as variables in the alarm
    //        so that in case AWS changes them, the rule will still be valid
    const hardLimit = queueResource.Properties?.FifoQueue ? 20000 : 120000
    const thresholdValue = Math.floor(hardLimit * threshold / 100)
    return {
      resourceName: `slicWatchSQSInFlightMsgsAlarm${logicalId}`,
      resource: createSqsAlarm(
        { 'Fn::Sub': `SQS_ApproximateNumberOfMessagesNotVisible_\${${logicalId}}` }, // alarmName
        { 'Fn::Sub': `SQS in-flight messages for \${${logicalId}} breaches ${thresholdValue} (${threshold}% of the hard limit of ${hardLimit})` }, // alarmDescription
        `${logicalId}`,
        config.ComparisonOperator, // comparisonOperator
        thresholdValue, // threshold
        'ApproximateNumberOfMessagesNotVisible', // metricName
        config.Statistic, // statistic
        config.Period, // period
        config.EvaluationPeriods,
        config.TreatMissingData
      )
    }
  }

  function createOldestMsgAgeAlarm (logicalId, queueResource, config) {
    const threshold = config.Threshold
    return {
      resourceName: `slicWatchSQSOldestMsgAgeAlarm${logicalId}`,
      resource: createSqsAlarm(
        { 'Fn::Sub': `SQS_ApproximateAgeOfOldestMessage_\${${logicalId}}` }, // alarmName
        { 'Fn::Sub': `SQS age of oldest message in the queue \${${logicalId}} breaches ${threshold}` }, // alarmDescription
        `${logicalId}`,
        config.ComparisonOperator, // comparisonOperator
        threshold, // threshold
        'ApproximateAgeOfOldestMessage', // metricName
        config.Statistic, // statistic
        config.Period, // period
        config.EvaluationPeriods,
        config.TreatMissingData
      )
    }
  }
}
