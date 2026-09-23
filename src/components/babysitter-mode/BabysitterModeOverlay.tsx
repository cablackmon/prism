'use client';

import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import {
  Cloud,
  CloudRain,
  CloudSnow,
  Sun,
  CloudSun,
  Droplets,
  Wind,
  Wifi,
  Phone,
  Home,
  User,
  ScrollText,
  AlertTriangle,
  Lock,
} from 'lucide-react';
import { useBabysitterMode } from '@/lib/hooks/useBabysitterMode';
import {
  useBabysitterInfo,
  type BabysitterSection,
  type BabysitterInfoItem,
} from '@/lib/hooks/useBabysitterInfo';
import { useWifiConfig } from '@/lib/hooks/useWifiConfig';
import { ExitBabysitterModeModal } from './ExitBabysitterModeModal';
import { WifiQRCode } from '@/components/ui/WifiQRCode';
import { cn } from '@/lib/utils';
import { useTimeFormat } from '@/components/providers';
import { formatDisplayTime, toDisplayDate } from '@/lib/utils/timeFormat';

interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  isPrimary?: string;
}

interface HouseInfo {
  label: string;
  value: string;
}

interface ChildInfo {
  name: string;
  age?: string;
  allergies?: string;
  medications?: string;
  bedtime?: string;
  notes?: string;
}

interface HouseRule {
  rule: string;
  importance?: string;
}

export function BabysitterModeOverlay() {
  const { isActive, toggle } = useBabysitterMode();
  // Only fetch sensitive data when the overlay is actually active — avoids 401s for unauthenticated users
  const { items } = useBabysitterInfo({ includeSensitive: isActive });
  const {
    config: wifiConfig,
    qrString,
    hasConfig: hasWifiConfig,
  } = useWifiConfig({ enabled: isActive });
  const [visible, setVisible] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);

  // Fade in effect
  useEffect(() => {
    if (isActive) {
      const timer = setTimeout(() => setVisible(true), 50);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
      setShowExitModal(false);
    }
  }, [isActive]);

  const handleExitSuccess = useCallback(async () => {
    await toggle(false);
    setShowExitModal(false);
  }, [toggle]);

  const handleOverlayClick = useCallback(() => {
    setShowExitModal(true);
  }, []);

  if (!isActive) return null;

  const getItemsBySection = (section: BabysitterSection) =>
    items.filter((item) => item.section === section);

  return (
    <div
      className={`fixed inset-0 z-[9997] cursor-pointer overflow-auto bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900 transition-opacity duration-1000 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={handleOverlayClick}
    >
      {/* Header with clock and weather */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-black/30 backdrop-blur-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <BabysitterClock />
          </div>
          <BabysitterWeather />
        </div>
      </div>

      {/* Main content */}
      <div className="p-6 pb-24">
        <h1 className="mb-6 text-center text-3xl font-bold text-white">Babysitter Information</h1>

        {items.length === 0 ? (
          <div className="py-12 text-center text-white/60">
            <ScrollText className="mx-auto mb-4 h-12 w-12 opacity-50" />
            <p className="text-lg">No information configured</p>
            <p className="mt-1 text-sm">Parents can add info in Settings</p>
          </div>
        ) : (
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 md:grid-cols-2">
            {/* WiFi QR Code */}
            {hasWifiConfig && qrString && (
              <div className="rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
                  <Wifi className="h-5 w-5" />
                  WiFi
                </h2>
                <div onClick={(e) => e.stopPropagation()}>
                  <WifiQRCode
                    ssid={wifiConfig.ssid}
                    qrString={qrString}
                    size={120}
                    showLabel={true}
                  />
                </div>
              </div>
            )}

            {/* Emergency Contacts */}
            <SectionCard
              title="Emergency Contacts"
              icon={<Phone className="h-5 w-5" />}
              items={getItemsBySection('emergency_contact')}
              renderItem={(item) => (
                <EmergencyContactCard content={item.content as unknown as EmergencyContact} />
              )}
            />

            {/* House Info */}
            <SectionCard
              title="House Information"
              icon={<Home className="h-5 w-5" />}
              items={getItemsBySection('house_info')}
              renderItem={(item) => (
                <HouseInfoCard content={item.content as unknown as HouseInfo} />
              )}
            />

            {/* Children */}
            <SectionCard
              title="Children"
              icon={<User className="h-5 w-5" />}
              items={getItemsBySection('child_info')}
              renderItem={(item) => (
                <ChildInfoCard content={item.content as unknown as ChildInfo} />
              )}
            />

            {/* House Rules */}
            <SectionCard
              title="House Rules"
              icon={<ScrollText className="h-5 w-5" />}
              items={getItemsBySection('house_rule')}
              renderItem={(item) => (
                <HouseRuleCard content={item.content as unknown as HouseRule} />
              )}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-black/30 py-4 text-center backdrop-blur-sm">
        <p className="text-sm text-white/50">Tap anywhere to unlock</p>
      </div>

      {/* Exit modal */}
      <ExitBabysitterModeModal
        open={showExitModal}
        onOpenChange={setShowExitModal}
        onSuccess={handleExitSuccess}
      />
    </div>
  );
}

function BabysitterClock() {
  const { timeFormat, displayTimezone } = useTimeFormat();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="text-white">
      <div className="text-4xl font-light tabular-nums">
        {formatDisplayTime(time, timeFormat, {}, displayTimezone)}
      </div>
      <div className="text-sm text-white/60">
        {format(toDisplayDate(time, displayTimezone), 'EEEE, MMMM d')}
      </div>
    </div>
  );
}

function BabysitterWeather() {
  const [data, setData] = useState<{
    current: { temperature: number; condition: string; description: string };
    units: { temperature: 'F' | 'C' };
  } | null>(null);

  useEffect(() => {
    async function fetchWeather() {
      try {
        const res = await fetch('/api/weather');
        if (res.ok) {
          const json = await res.json();
          if (json.current && json.units) setData({ current: json.current, units: json.units });
        }
      } catch {
        // Weather is optional
      }
    }
    fetchWeather();
    const interval = setInterval(fetchWeather, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (!data) return null;
  const { current: weather, units } = data;

  const icon = getWeatherIcon(weather.condition);

  return (
    <div className="flex items-center gap-3 text-white/80">
      <div className="text-3xl">{icon}</div>
      <div>
        <div className="text-2xl font-light">
          {Math.round(weather.temperature)}°{units.temperature}
        </div>
        <div className="text-xs capitalize text-white/50">{weather.description}</div>
      </div>
    </div>
  );
}

function getWeatherIcon(condition: string) {
  const cls = 'h-8 w-8 text-white/70';
  switch (condition) {
    case 'sunny':
      return <Sun className={cls} />;
    case 'partly-cloudy':
      return <CloudSun className={cls} />;
    case 'cloudy':
      return <Cloud className={cls} />;
    case 'rainy':
    case 'stormy':
      return <CloudRain className={cls} />;
    case 'snowy':
      return <CloudSnow className={cls} />;
    default:
      return <Cloud className={cls} />;
  }
}

interface SectionCardProps {
  title: string;
  icon: React.ReactNode;
  items: BabysitterInfoItem[];
  renderItem: (item: BabysitterInfoItem) => React.ReactNode;
}

function SectionCard({ title, icon, items, renderItem }: SectionCardProps) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
        {icon}
        {title}
      </h2>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id}>{renderItem(item)}</div>
        ))}
      </div>
    </div>
  );
}

function EmergencyContactCard({ content }: { content: EmergencyContact }) {
  if (!content) return null;

  return (
    <div className="flex items-center justify-between rounded-lg bg-white/10 p-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-white">{content.name}</span>
          {content.isPrimary === 'true' && (
            <span className="rounded bg-green-500/30 px-2 py-0.5 text-xs text-green-300">
              Primary
            </span>
          )}
        </div>
        <p className="text-sm text-white/60">{content.relationship}</p>
      </div>
      <a
        href={`tel:${content.phone}`}
        onClick={(e) => e.stopPropagation()}
        className="text-lg font-medium text-blue-300 hover:text-blue-200"
      >
        {content.phone}
      </a>
    </div>
  );
}

function HouseInfoCard({ content }: { content: HouseInfo }) {
  if (!content) return null;

  return (
    <div className="flex items-center justify-between rounded-lg bg-white/10 p-3">
      <span className="text-sm text-white/60">{content.label}</span>
      <span className="font-medium text-white">{content.value}</span>
    </div>
  );
}

function ChildInfoCard({ content }: { content: ChildInfo }) {
  if (!content) return null;

  return (
    <div className="space-y-1 rounded-lg bg-white/10 p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-white">{content.name}</span>
        {content.age && <span className="text-sm text-white/60">Age: {content.age}</span>}
      </div>
      {content.allergies && (
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <span className="text-sm text-red-300">
            <strong>Allergies:</strong> {content.allergies}
          </span>
        </div>
      )}
      {content.medications && (
        <p className="text-sm text-white/70">
          <span className="text-white/50">Medications:</span> {content.medications}
        </p>
      )}
      {content.bedtime && (
        <p className="text-sm text-white/70">
          <span className="text-white/50">Bedtime:</span> {content.bedtime}
        </p>
      )}
      {content.notes && <p className="text-sm italic text-white/50">{content.notes}</p>}
    </div>
  );
}

function HouseRuleCard({ content }: { content: HouseRule }) {
  if (!content) return null;

  const importanceColors: Record<string, string> = {
    high: 'border-l-red-400',
    medium: 'border-l-yellow-400',
    low: 'border-l-white/30',
  };

  return (
    <div
      className={cn(
        'rounded-lg border-l-4 bg-white/10 p-3',
        importanceColors[content.importance || 'medium']
      )}
    >
      <p className="text-sm text-white">{content.rule}</p>
    </div>
  );
}
