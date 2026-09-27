'use client';

import {
  LINUX_FILENAME,
  MAC_APPLE_SILICON_FILENAME,
  MAC_INTEL_FILENAME,
  WINDOWS_FILENAME,
} from '@/app/api/download-agent/constants';
import { detectOSFromUserAgent, SupportedOS } from '@/utils/os';
import type { Device, Member } from '@db';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Spinner,
} from '@trycompai/design-system';
import { CheckmarkFilled, CircleDash, Download, Renew } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { FleetPolicy, Host } from '../../types';
import { FleetPolicyItem } from './FleetPolicyItem';

interface DeviceAgentAccordionItemProps {
  member: Member;
  host: Host | null;
  agentDevices: Device[];
  isLoading: boolean;
  fleetPolicies?: FleetPolicy[];
  fetchFleetPolicies: () => void;
}

export function DeviceAgentAccordionItem({
  member,
  host,
  agentDevices,
  isLoading,
  fleetPolicies = [],
  fetchFleetPolicies,
}: DeviceAgentAccordionItemProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [detectedOS, setDetectedOS] = useState<SupportedOS | null>(null);
  const t = useTranslations('deviceAgent');
  const tTasks = useTranslations('tasks');
  const tToasts = useTranslations('toasts');

  const isMacOS = useMemo(
    () => detectedOS === 'macos' || detectedOS === 'macos-intel',
    [detectedOS],
  );

  const hasFleetDevice = host !== null;
  const hasAnyAgentDevice = agentDevices.length > 0;
  const failedPoliciesCount = useMemo(
    () => fleetPolicies.filter((policy) => policy.response !== 'pass').length,
    [fleetPolicies],
  );

  const isCompleted = hasAnyAgentDevice
    ? agentDevices.some((d) => d.isCompliant)
    : hasFleetDevice
      ? failedPoliciesCount === 0
      : false;

  const handleDownload = async () => {
    if (!detectedOS) {
      toast.error(t('osUndetected'));
      return;
    }

    setIsDownloading(true);

    try {
      // First, we need to get a download token/session from the API
      const tokenResponse = await fetch('/api/download-agent/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: member.organizationId,
          employeeId: member.id,
          os: detectedOS,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(errorText || t('downloadPrepareFailed'));
      }

      const { token } = await tokenResponse.json();

      // Now trigger the actual download using the browser's native download mechanism
      // This will show in the browser's download UI immediately
      const downloadUrl = `/api/download-agent?token=${encodeURIComponent(token)}`;

      // Method 1: Using a temporary link (most reliable)
      const a = document.createElement('a');
      a.href = downloadUrl;

      // Set filename based on OS and architecture
      if (isMacOS) {
        a.download = detectedOS === 'macos' ? MAC_APPLE_SILICON_FILENAME : MAC_INTEL_FILENAME;
      } else if (detectedOS === 'linux') {
        a.download = LINUX_FILENAME;
      } else {
        a.download = WINDOWS_FILENAME;
      }

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      toast.success(t('downloadStarted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('downloadFailed'));
    } finally {
      // Reset after a short delay to allow download to start
      setTimeout(() => {
        setIsDownloading(false);
      }, 1000);
    }
  };

  const getButtonContent = () => {
    if (isDownloading) {
      return (
        <>
          <Spinner size="sm" />
          {t('downloading')}
        </>
      );
    } else {
      return (
        <>
          <Download size={16} />
          {t('downloadAgent')}
        </>
      );
    }
  };

  const handleRefresh = () => {
    fetchFleetPolicies();
  };

  useEffect(() => {
    const detectOS = async () => {
      const os = await detectOSFromUserAgent();
      setDetectedOS(os);
    };
    detectOS();
  }, []);

  return (
    <div className="border rounded-xs">
      <AccordionItem value="device-agent">
        <div className="px-4">
          <AccordionTrigger>
            <div className="flex items-center gap-3">
              {isCompleted ? (
                <div className="text-primary">
                  <CheckmarkFilled size={20} />
                </div>
              ) : (
                <div className="text-muted-foreground">
                  <CircleDash size={20} />
                </div>
              )}
              <span
                className={cn('text-base', isCompleted && 'text-muted-foreground line-through')}
              >
                {tTasks('deviceAgent')}
              </span>
              {!hasAnyAgentDevice && hasFleetDevice && failedPoliciesCount > 0 && (
                <span className="text-amber-600 dark:text-amber-400 text-xs ml-auto">
                  {tTasks('policiesFailing', { count: failedPoliciesCount })}
                </span>
              )}
            </div>
          </AccordionTrigger>
        </div>
        <AccordionContent>
          <div className="px-4 pb-4 space-y-4">
            <p className="text-sm">
              {t('description')}
            </p>

            {agentDevices.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t('yourDevices')}
                </p>
                {agentDevices.map((device) => (
                  <Card key={device.id}>
                    <CardHeader>
                      <CardTitle>
                        <span className="text-lg">{device.name}</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          {device.isCompliant ? (
                            <div className="text-primary">
                              <CheckmarkFilled size={16} />
                            </div>
                          ) : (
                            <div className="text-amber-600 dark:text-amber-400">
                              <CircleDash size={16} />
                            </div>
                          )}
                          <span className="text-sm">
                            {device.isCompliant
                              ? t('allPassing')
                              : t('needsAttention')}
                          </span>
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {device.platform} &middot; {device.osVersion}
                          {device.lastCheckIn && (
                            <>
                              {' '}
                              &middot; {t('lastCheckIn')}:{' '}
                              {new Date(device.lastCheckIn).toLocaleDateString()}
                            </>
                          )}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {!hasAnyAgentDevice && hasFleetDevice && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CardTitle>
                      <span className="text-lg">{host.computer_name}</span>
                    </CardTitle>
                    <Button
                      variant="ghost"
                      onClick={handleRefresh}
                      disabled={isLoading}
                      iconLeft={
                        <div className={cn(isLoading && 'animate-spin')}>
                          <Renew size={16} />
                        </div>
                      }
                    >
                      {t('refresh')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {fleetPolicies.length > 0 ? (
                      <>
                        {fleetPolicies.map((policy) => (
                          <FleetPolicyItem
                            key={policy.id}
                            policy={policy}
                            organizationId={member.organizationId}
                            onRefresh={handleRefresh}
                          />
                        ))}
                      </>
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        {t('noPoliciesForDevice')}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="space-y-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {hasAnyAgentDevice ? t('addAnotherDevice') : t('installOnDevice')}
              </p>
              <ol className="list-decimal space-y-4 pl-5 text-sm">
                <li>
                  <strong>{t('stepDownloadTitle')}</strong>
                  <p className="mt-1">
                    {t('stepDownloadBody')}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    {isMacOS && (
                      <div className="w-[136px]">
                        <Select
                          value={detectedOS || 'macos'}
                          onValueChange={(value) => {
                            if (value) setDetectedOS(value as SupportedOS);
                          }}
                        >
                          <SelectTrigger>
                            <span>{detectedOS === 'macos-intel' ? 'Intel' : 'Apple Silicon'}</span>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="macos">Apple Silicon</SelectItem>
                            <SelectItem value="macos-intel">Intel</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <Button onClick={handleDownload} disabled={isDownloading}>
                      {getButtonContent()}
                    </Button>
                  </div>
                </li>
                <li>
                  <strong>{t('stepInstallTitle')}</strong>
                  <p className="mt-1">
                    {isMacOS
                      ? t('stepInstallMac')
                      : detectedOS === 'linux'
                        ? t('stepInstallLinux')
                        : t('stepInstallWindows')}
                  </p>
                </li>
                <li>
                  <strong>{t('stepLoginTitle')}</strong>
                  <p className="mt-1">
                    {t('stepLoginBody')}
                  </p>
                </li>
              </ol>
            </div>

            <div className="mt-4 space-y-2">
              <Accordion>
                <div className="border rounded-xs mt-4">
                  <AccordionItem value="system-requirements">
                    <div className="px-4">
                      <AccordionTrigger>
                        <span className="text-base">{t('systemRequirements')}</span>
                      </AccordionTrigger>
                    </div>
                    <AccordionContent>
                      <div className="px-4 pb-4 text-muted-foreground space-y-2 text-sm">
                        <p>
                          {t('reqOs')}
                        </p>
                        <p>
                          {t('reqMemory')}
                        </p>
                        <p>
                          {t('reqStorage')}
                        </p>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </div>
              </Accordion>

              <Accordion>
                <div className="border rounded-xs">
                  <AccordionItem value="about">
                    <div className="px-4">
                      <AccordionTrigger>
                        <span className="text-base">{t('aboutTitle')}</span>
                      </AccordionTrigger>
                    </div>
                    <AccordionContent>
                      <div className="px-4 pb-4 text-muted-foreground space-y-2 text-sm">
                        <p>
                          {t('aboutBody1')}
                        </p>
                        <p>
                          {t('aboutBody2')}
                        </p>
                        <p>
                          {t('aboutBody3')}
                        </p>
                        <p className="text-xs">
                          {t('aboutContact')}
                        </p>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </div>
              </Accordion>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </div>
  );
}
